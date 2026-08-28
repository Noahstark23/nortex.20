import {
    Ban,
    Banknote,
    CalendarClock,
    CheckCircle2,
    FileText,
    Mail,
    MapPin,
    MessageCircle,
    MessageSquare,
    Pencil,
    Phone,
    ReceiptText,
    ShieldCheck,
    UserRound,
} from 'lucide-react';
import type { CustomerHubDetail, CustomerHubListItem } from '../Clients';
import { formatMoney } from '../../utils/money';

type SellerOption = { id: string; name: string };

interface Customer360DetailProps {
    detail: CustomerHubDetail;
    canEditProfile: boolean;
    canWriteInteraction: boolean;
    canManageControls: boolean;
    canAssignSeller: boolean;
    sellers: SellerOption[];
    onEdit: () => void;
    onRegisterInteraction: () => void;
    onResolveInteraction: (interactionId: string) => void;
    onSendStatement: () => void;
    onOpenReceivables: () => void;
    onToggleBlock: (customer: CustomerHubListItem) => void;
    onToggleWholesale: (customer: CustomerHubListItem) => void;
    onAssignSeller: (customerId: string, sellerId: string) => void;
}

const MANAGUA_TIME_ZONE = 'America/Managua';

const money = (value: number) => formatMoney(value);

function formatCustomerDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('es-NI', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: MANAGUA_TIME_ZONE,
    });
}

function civilDayNumber(value: Date | string): number {
    const date = value instanceof Date ? value : new Date(value);
    const parts = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: MANAGUA_TIME_ZONE,
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
    return Math.floor(Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000);
}

function overdueDays(dueDate: string | null): number {
    if (!dueDate) return 0;
    const due = new Date(dueDate);
    if (Number.isNaN(due.getTime())) return 0;
    return Math.max(0, civilDayNumber(new Date()) - civilDayNumber(due));
}

function riskFor(detail: CustomerHubDetail) {
    const overdue = detail.receivables.invoices
        .filter((invoice) => invoice.status === 'OVERDUE')
        .map((invoice) => overdueDays(invoice.dueDate));
    const maxOverdue = overdue.length > 0 ? Math.max(...overdue) : 0;

    if (detail.profile.isBlocked) {
        return {
            label: 'Alto',
            tone: 'text-red-300',
            dot: 'bg-red-400',
            reason: 'Crédito bloqueado. Revisá la deuda y la última gestión antes de habilitar nuevas ventas.',
            maxOverdue,
        };
    }
    if (detail.profile.segment === 'overlimit' || detail.receivables.totals.overdue > 0) {
        return {
            label: 'Alto',
            tone: 'text-red-300',
            dot: 'bg-red-400',
            reason: maxOverdue > 0
                ? `Tiene saldo vencido; la factura más atrasada acumula ${maxOverdue} días.`
                : 'El saldo supera el límite de crédito disponible.',
            maxOverdue,
        };
    }
    if (detail.receivables.totals.balance > 0) {
        return {
            label: 'Medio',
            tone: 'text-amber-300',
            dot: 'bg-amber-400',
            reason: 'Mantiene saldo abierto, pero no hay facturas vencidas en este momento.',
            maxOverdue,
        };
    }
    return {
        label: 'Bajo',
        tone: 'text-emerald-300',
        dot: 'bg-emerald-400',
        reason: 'No registra saldo pendiente ni señales de riesgo activas.',
        maxOverdue,
    };
}

function eventIcon(type: string) {
    if (type === 'payment') return <Banknote size={16} aria-hidden="true" />;
    if (type === 'sale') return <ReceiptText size={16} aria-hidden="true" />;
    return <MessageSquare size={16} aria-hidden="true" />;
}

export default function Customer360Detail({
    detail,
    canEditProfile,
    canWriteInteraction,
    canManageControls,
    canAssignSeller,
    sellers,
    onEdit,
    onRegisterInteraction,
    onResolveInteraction,
    onSendStatement,
    onOpenReceivables,
    onToggleBlock,
    onToggleWholesale,
    onAssignSeller,
}: Customer360DetailProps) {
    const risk = riskFor(detail);
    const openInteractions = detail.interactions.filter((interaction) => interaction.status === 'OPEN');

    return (
        <div className="space-y-4" data-testid="customer-360-detail">
            <header className="flex flex-col gap-4 border-b border-white/[0.06] pb-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-2xl font-black text-slate-100 sm:text-3xl">{detail.profile.name}</h2>
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                            Cliente
                        </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-400">
                        <span>{detail.profile.taxId || 'Sin RUC/DNI'}</span>
                        <span aria-hidden="true">•</span>
                        <span>{detail.profile.phone || 'Sin teléfono'}</span>
                        <span aria-hidden="true">•</span>
                        <span>Última compra {formatCustomerDate(detail.profile.lastSaleAt)}</span>
                    </div>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button
                        type="button"
                        onClick={onSendStatement}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-white/[0.10] bg-white/[0.03] px-4 text-sm font-bold text-slate-100 transition-colors hover:bg-white/[0.07]"
                    >
                        <MessageCircle size={17} aria-hidden="true" /> Enviar estado
                    </button>
                    {canWriteInteraction && (
                        <button
                            type="button"
                            onClick={onRegisterInteraction}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-emerald-500 px-4 text-sm font-black text-slate-950 transition-colors hover:bg-emerald-400"
                        >
                            <MessageSquare size={17} aria-hidden="true" /> Registrar gestión
                        </button>
                    )}
                </div>
            </header>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_244px]">
                <div className="min-w-0 space-y-4">
                    <section className="grid overflow-hidden rounded-card border border-white/[0.07] bg-surface-900/85 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen del cliente">
                        <div className="border-b border-white/[0.06] p-4 sm:border-r lg:border-b-0">
                            <div className="text-[11px] font-mono uppercase tracking-wide text-slate-500">Saldo actual</div>
                            <div className={`mt-2 text-xl font-black ${detail.receivables.totals.balance > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                                {money(detail.receivables.totals.balance)}
                            </div>
                            {risk.maxOverdue > 0 && <div className="mt-1 text-xs font-bold text-red-300">Vencida {risk.maxOverdue} días</div>}
                        </div>
                        <div className="border-b border-white/[0.06] p-4 lg:border-b-0 lg:border-r">
                            <div className="text-[11px] font-mono uppercase tracking-wide text-slate-500">Facturado</div>
                            <div className="mt-2 text-xl font-black text-slate-200">{money(detail.receivables.totals.billed)}</div>
                        </div>
                        <div className="border-b border-white/[0.06] p-4 sm:border-r sm:border-b-0">
                            <div className="text-[11px] font-mono uppercase tracking-wide text-slate-500">Abonado</div>
                            <div className="mt-2 text-xl font-black text-emerald-300">{money(detail.receivables.totals.paid)}</div>
                        </div>
                        <div className="p-4">
                            <div className="text-[11px] font-mono uppercase tracking-wide text-slate-500">Límite de crédito</div>
                            <div className="mt-2 text-xl font-black text-slate-200">{money(detail.profile.creditLimit)}</div>
                        </div>
                    </section>

                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[10px] font-mono uppercase tracking-wide text-emerald-300">Cobranza</div>
                                <h3 className="mt-1 text-base font-black text-slate-100">Estado de cuenta</h3>
                                <p className="mt-1 text-xs text-slate-500">Facturas, abonos y saldos vigentes.</p>
                            </div>
                            <button
                                type="button"
                                onClick={onOpenReceivables}
                                className="shrink-0 rounded-control border border-white/[0.08] px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/[0.05] hover:text-white"
                            >
                                Ver completo
                            </button>
                        </div>

                        {detail.receivables.invoices.length === 0 ? (
                            <div className="mt-4 rounded-control border border-dashed border-white/[0.10] bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                                Este cliente no tiene facturas a crédito abiertas.
                            </div>
                        ) : (
                            <div className="mt-4 overflow-x-auto rounded-control border border-white/[0.06]">
                                <table className="w-full min-w-[612px] table-fixed border-collapse text-left text-xs">
                                    <colgroup>
                                        <col className="w-[132px]" />
                                        <col className="w-[74px]" />
                                        <col className="w-[74px]" />
                                        <col className="w-[84px]" />
                                        <col className="w-[84px]" />
                                        <col className="w-[84px]" />
                                        <col className="w-[80px]" />
                                    </colgroup>
                                    <thead className="bg-white/[0.025] text-[10px] font-mono uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-2 py-3 font-medium">Documento</th>
                                            <th className="px-2 py-3 font-medium">Emitido</th>
                                            <th className="px-2 py-3 font-medium">Vence</th>
                                            <th className="px-2 py-3 text-right font-medium">Monto</th>
                                            <th className="px-2 py-3 text-right font-medium">Abonado</th>
                                            <th className="px-2 py-3 text-right font-medium">Saldo</th>
                                            <th className="px-2 py-3 font-medium">Estado</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detail.receivables.invoices.slice(0, 8).map((invoice) => (
                                            <tr key={invoice.id} className="border-t border-white/[0.06] text-slate-300">
                                                <td className="truncate px-2 py-3 font-bold text-slate-100" title={invoice.invoiceNumber || invoice.id}>
                                                    {invoice.invoiceNumber ? `Factura #${invoice.invoiceNumber}` : `Venta ${invoice.id.slice(0, 8)}`}
                                                </td>
                                                <td className="px-2 py-3 text-[11px] leading-4">{formatCustomerDate(invoice.date)}</td>
                                                <td className={invoice.status === 'OVERDUE' ? 'px-2 py-3 text-[11px] font-bold leading-4 text-red-300' : 'px-2 py-3 text-[11px] leading-4'}>
                                                    {formatCustomerDate(invoice.dueDate)}
                                                </td>
                                                <td className="whitespace-nowrap px-2 py-3 text-right font-semibold">{money(invoice.total)}</td>
                                                <td className="whitespace-nowrap px-2 py-3 text-right font-semibold text-emerald-300">{money(invoice.paid)}</td>
                                                <td className="whitespace-nowrap px-2 py-3 text-right font-black text-red-300">{money(invoice.balance)}</td>
                                                <td className="px-2 py-3">
                                                    <span className={`whitespace-nowrap rounded-full px-1.5 py-1 text-[9px] font-bold ${
                                                        invoice.status === 'OVERDUE'
                                                            ? 'bg-red-500/15 text-red-300'
                                                            : invoice.status === 'PAID'
                                                                ? 'bg-emerald-500/15 text-emerald-300'
                                                                : 'bg-amber-500/15 text-amber-300'
                                                    }`}>
                                                        {invoice.status === 'OVERDUE'
                                                            ? `Vencida ${overdueDays(invoice.dueDate)}d`
                                                            : invoice.status === 'PAID' ? 'Pagada' : 'Pendiente'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>

                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4 sm:p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 className="text-base font-black text-slate-100">Actividad reciente</h3>
                                <p className="mt-1 text-xs text-slate-500">Ventas, abonos, gestiones y cambios sensibles.</p>
                            </div>
                            <span className="rounded-control border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-xs font-bold text-slate-400">Todos</span>
                        </div>

                        {detail.timeline.length === 0 ? (
                            <div className="mt-4 rounded-control border border-dashed border-white/[0.10] bg-white/[0.02] p-6 text-center text-sm text-slate-500">
                                Todavía no hay actividad relevante para mostrar.
                            </div>
                        ) : (
                            <ol className="relative mt-5 ml-3 border-l border-white/[0.10]">
                                {detail.timeline.slice(0, 10).map((event) => (
                                    <li key={event.id} className="relative ml-7 border-b border-white/[0.05] pb-4 pt-1 last:border-b-0 last:pb-0">
                                        <span className={`absolute -left-[2.72rem] top-0.5 flex h-8 w-8 items-center justify-center rounded-full border ${
                                            event.type === 'payment'
                                                ? 'border-emerald-500/25 bg-emerald-500/15 text-emerald-300'
                                                : event.type === 'sale'
                                                    ? 'border-nortex-500/25 bg-nortex-500/15 text-nortex-300'
                                                    : 'border-amber-500/25 bg-amber-500/15 text-amber-300'
                                        }`}>
                                            {eventIcon(event.type)}
                                        </span>
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="font-bold text-slate-100">{event.title}</div>
                                                <div className="mt-1 break-words text-sm leading-5 text-slate-400">{event.subtitle}</div>
                                                {event.meta && <div className="mt-1 text-xs text-slate-500">{event.meta}</div>}
                                            </div>
                                            <div className="shrink-0 text-left sm:text-right">
                                                {event.amount !== null && <div className="font-black text-emerald-300">{money(event.amount)}</div>}
                                                <div className="mt-1 text-xs text-slate-500">{formatCustomerDate(event.happenedAt)}</div>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>

                    {openInteractions.length > 0 && (
                        <section className="rounded-card border border-amber-500/15 bg-amber-500/[0.04] p-4 sm:p-5">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="text-base font-black text-slate-100">Gestiones pendientes</h3>
                                    <p className="mt-1 text-xs text-slate-500">Promesas y seguimientos que todavía requieren acción.</p>
                                </div>
                                <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-200">{openInteractions.length}</span>
                            </div>
                            <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                {openInteractions.slice(0, 4).map((interaction) => (
                                    <article key={interaction.id} className="rounded-control border border-white/[0.07] bg-surface-900/70 p-4">
                                        <div className="text-sm font-black text-slate-100">
                                            {interaction.type === 'PROMISE' ? 'Promesa de pago' : 'Seguimiento'}
                                        </div>
                                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-slate-400">{interaction.note}</p>
                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                                            <span>{formatCustomerDate(interaction.followUpAt || interaction.promisedAt)}</span>
                                            {interaction.promisedAmount !== null && <span className="font-black text-amber-200">{money(interaction.promisedAmount)}</span>}
                                        </div>
                                        {canWriteInteraction && (
                                            <button
                                                type="button"
                                                onClick={() => onResolveInteraction(interaction.id)}
                                                className="mt-3 inline-flex items-center gap-2 rounded-control border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/15"
                                            >
                                                <CheckCircle2 size={14} aria-hidden="true" /> Marcar completada
                                            </button>
                                        )}
                                    </article>
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                <aside className="space-y-3" aria-label="Resumen operativo del cliente">
                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4">
                        <div className="text-sm font-black text-slate-200">Riesgo</div>
                        <div className={`mt-3 flex items-center gap-2 text-2xl font-black ${risk.tone}`}>
                            {risk.label} <span className={`h-2.5 w-2.5 rounded-full ${risk.dot}`} aria-hidden="true" />
                        </div>
                        <p className="mt-3 text-sm leading-5 text-slate-400">{risk.reason}</p>
                    </section>

                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4">
                        <div className="flex items-center gap-2 text-sm font-black text-slate-200">
                            <CalendarClock size={16} className="text-amber-300" aria-hidden="true" /> Próxima acción sugerida
                        </div>
                        <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">{detail.profile.nextAction}</p>
                        {canWriteInteraction && (
                            <button
                                type="button"
                                onClick={onRegisterInteraction}
                                className="mt-4 w-full rounded-control bg-emerald-500 px-3 py-2.5 text-sm font-black text-slate-950 hover:bg-emerald-400"
                            >
                                Programar seguimiento
                            </button>
                        )}
                    </section>

                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4">
                        <div className="text-sm font-black text-slate-200">Acciones rápidas</div>
                        <div className="mt-3 grid gap-1">
                            <button type="button" onClick={onOpenReceivables} className="inline-flex items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/[0.05] hover:text-white">
                                <Banknote size={16} className="text-emerald-300" aria-hidden="true" /> Registrar abono
                            </button>
                            <button type="button" onClick={onSendStatement} className="inline-flex items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/[0.05] hover:text-white">
                                <MessageCircle size={16} className="text-emerald-300" aria-hidden="true" /> Enviar estado por WhatsApp
                            </button>
                            {canEditProfile && (
                                <button type="button" onClick={onEdit} className="inline-flex items-center gap-2 rounded-control px-2 py-2 text-left text-sm text-slate-300 hover:bg-white/[0.05] hover:text-white">
                                    <Pencil size={16} aria-hidden="true" /> Editar ficha
                                </button>
                            )}
                        </div>
                    </section>

                    <section className="rounded-card border border-white/[0.07] bg-surface-900/85 p-4">
                        <div className="text-sm font-black text-slate-200">Información del cliente</div>
                        <dl className="mt-4 space-y-3 text-sm">
                            <div>
                                <dt className="text-[11px] font-mono uppercase text-slate-500">Contacto</dt>
                                <dd className="mt-1 text-slate-300">{detail.profile.name}</dd>
                            </div>
                            <div>
                                <dt className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-500"><Phone size={12} aria-hidden="true" /> Teléfono</dt>
                                <dd className="mt-1 break-words text-slate-300">{detail.profile.phone || 'Sin teléfono'}</dd>
                            </div>
                            <div>
                                <dt className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-500"><Mail size={12} aria-hidden="true" /> Correo</dt>
                                <dd className="mt-1 break-words text-slate-300">{detail.profile.email || 'Sin correo'}</dd>
                            </div>
                            <div>
                                <dt className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-500"><FileText size={12} aria-hidden="true" /> RUC / DNI</dt>
                                <dd className="mt-1 break-words text-slate-300">{detail.profile.taxId || 'Sin documento'}</dd>
                            </div>
                            <div>
                                <dt className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-500"><UserRound size={12} aria-hidden="true" /> Vendedor asignado</dt>
                                <dd className="mt-1 text-slate-300">{detail.profile.seller?.name || 'Sin asignar'}</dd>
                            </div>
                            {detail.profile.address && (
                                <div>
                                    <dt className="flex items-center gap-1 text-[11px] font-mono uppercase text-slate-500"><MapPin size={12} aria-hidden="true" /> Dirección</dt>
                                    <dd className="mt-1 break-words leading-5 text-slate-300">{detail.profile.address}</dd>
                                </div>
                            )}
                        </dl>

                        {canAssignSeller && (
                            <select
                                aria-label="Vendedor asignado"
                                value={detail.profile.sellerId || ''}
                                onChange={(event) => onAssignSeller(detail.profile.id, event.target.value)}
                                className="mt-4 w-full rounded-control border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500"
                            >
                                <option value="">Sin vendedor</option>
                                {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
                            </select>
                        )}

                        {canManageControls && (
                            <div className="mt-4 grid gap-2 border-t border-white/[0.06] pt-4">
                                <button
                                    type="button"
                                    onClick={() => onToggleBlock(detail.profile)}
                                    className={`inline-flex items-center justify-center gap-2 rounded-control px-3 py-2 text-xs font-bold ${
                                        detail.profile.isBlocked
                                            ? 'bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
                                            : 'bg-red-500/10 text-red-200 hover:bg-red-500/15'
                                    }`}
                                >
                                    {detail.profile.isBlocked ? <ShieldCheck size={14} aria-hidden="true" /> : <Ban size={14} aria-hidden="true" />}
                                    {detail.profile.isBlocked ? 'Desbloquear crédito' : 'Bloquear crédito'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onToggleWholesale(detail.profile)}
                                    className="rounded-control border border-white/[0.08] px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/[0.05] hover:text-white"
                                >
                                    {detail.profile.isWholesale ? 'Quitar mayoreo' : 'Activar mayoreo'}
                                </button>
                            </div>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}

